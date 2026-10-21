import 'dart:async';

import 'package:umi_contract/umi_contract.dart';

import '../../core/network/lan_node_identity.dart';
import 'kitchen_board_controller.dart';
import 'lan_kds_store.dart';

/// Keeps the main station's durable KDS copy current while the cloud is
/// reachable. When the uplink falls, the LAN node serves this last answer plus
/// every locally fired cart and every bump received over Wi-Fi.
final class LanKdsBridge {
  LanKdsBridge({
    required KitchenBoardRepository repository,
    required LanKdsStore store,
    required Future<LanNodeIdentity?> Function() identity,
    this.interval = const Duration(seconds: 5),
  }) : _repository = repository,
       _store = store,
       _identity = identity;

  final KitchenBoardRepository _repository;
  final LanKdsStore _store;
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
    final query = PosKitchenOrderQuery(
      locationId: identity.locationId,
      operatorSessionId: identity.operatorSessionId,
    );
    try {
      final orders = await _repository.snapshot(identity.merchantId, query);
      if (_stopped) return;
      await _store.saveCloudBoard(
        identity.merchantId,
        identity.locationId,
        orders.map((order) => order.toJson()).toList(growable: false),
      );
      try {
        final stations = await _repository.stations(identity.merchantId, query);
        if (!_stopped) {
          await _store.saveStations(
            identity.merchantId,
            identity.locationId,
            stations,
          );
        }
      } catch (_) {
        // The board is the job. Station labels are configuration.
      }
    } catch (_) {
      // The last server answer and the local journal stay available.
    } finally {
      _busy = false;
    }
  }
}
