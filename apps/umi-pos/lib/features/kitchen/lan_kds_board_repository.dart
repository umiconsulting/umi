import 'package:umi_contract/umi_contract.dart';

import 'kitchen_board_controller.dart';
import 'lan_kds_store.dart';

/// Reads the KDS board from the main station's local store first.
///
/// The local store holds the last cloud board and every cart fired on this
/// station. A new ticket must appear at once, even when the cloud is healthy
/// but has not received the fire command yet.
///
/// Configuration and counts stay on the cloud. The board refresh loop keeps
/// the local store current with the cloud board.
final class LanKdsBoardRepository
    implements KitchenBoardRepository, KitchenUnassignedRepository {
  const LanKdsBoardRepository({
    required LanKdsStore store,
    required ApiKitchenBoardRepository cloud,
  }) : _store = store,
       _cloud = cloud;

  final LanKdsStore _store;
  final ApiKitchenBoardRepository _cloud;

  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final local = await _store.snapshot(merchantId, query.locationId);
    return local.map(KitchenOrderProjection.fromJson).toList(growable: false);
  }

  @override
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  ) => _cloud.allDay(merchantId, query);

  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) =>
      _cloud.watch(merchantId, query);

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      _cloud.prepList(merchantId, query);

  @override
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final local = await _store.stations(merchantId, query.locationId);
    if (local.isNotEmpty) {
      return local.map(KitchenStation.fromJson).toList(growable: false);
    }
    return _cloud.stations(merchantId, query);
  }

  @override
  Future<List<KitchenUnassignedOrderProjection>> unassigned(
    String merchantId,
    PosKitchenOrderQuery query,
  ) => _cloud.unassigned(merchantId, query);

  @override
  Future<KitchenUnassignedCommandResult> resolveUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) => _cloud.resolveUnassigned(merchantId, request);

  @override
  Future<KitchenUnassignedCommandResult> discardUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) => _cloud.discardUnassigned(merchantId, request);
}
