import 'dart:async';

import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';
import '../../core/network/lan_node_identity.dart';

/// Keeps this peer paired with the main station before an outage starts.
final class LanPeerRegistration {
  LanPeerRegistration({
    required BoundedApiClient api,
    required Future<LanNodeIdentity?> Function() identity,
    this.interval = const Duration(seconds: 15),
  }) : _api = api,
       _identity = identity;

  final BoundedApiClient _api;
  final Future<LanNodeIdentity?> Function() _identity;
  final Duration interval;
  Timer? _timer;
  bool _busy = false;
  bool _stopped = false;

  void start() {
    _stopped = false;
    _timer ??= Timer.periodic(interval, (_) => unawaited(_tick()));
    unawaited(_tick());
  }

  void stop() {
    _stopped = true;
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    if (_busy || _stopped) return;
    final identity = await _identity();
    if (identity == null || _stopped) return;
    _busy = true;
    try {
      await _api.warmLanHub(
        Uri(
          path: UmiRoutes.posKitchenBoard(identity.merchantId),
          queryParameters: {
            'locationId': identity.locationId,
            'operatorSessionId': identity.operatorSessionId,
          },
        ).toString(),
      );
    } catch (_) {
      // The cloud path remains active. The next warm-up retries the pairing.
    } finally {
      _busy = false;
    }
  }
}
